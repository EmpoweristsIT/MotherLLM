const express = require('express');
const axios = require('axios');
const morgan = require('morgan');
const msal = require('@azure/msal-node');
const session = require('express-session');
const crypto = require('crypto');
const helmet = require('helmet');
const validator = require('validator');
require('dotenv').config();

const requiredEnv = [
    'SESSION_SECRET',
    'AZURE_CLIENT_ID',
    'AZURE_TENANT_ID',
    'AZURE_CLIENT_SECRET',
    'API_KEY',
    'ANYTHINGLLM_BASE_URL',
    'WORKSPACE_SLUG'
];

const missing = requiredEnv.filter(name => !process.env[name]);

if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
}


const app = express();
const port = process.env.PORT || 3000;
app.set('trust proxy', 1); // Important when behind Nginx or any reverse proxy
app.use(helmet());
app.use(morgan('combined'));

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: 'auto',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds
    }
}));

const msalConfig = {
    auth: {
        clientId: process.env.AZURE_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
        clientSecret: process.env.AZURE_CLIENT_SECRET,
    }
};

const cca = new msal.ConfidentialClientApplication(msalConfig);

const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3000/redirect';
const ANYTHINGLLM_BASE_URL = process.env.ANYTHINGLLM_BASE_URL;
const API_KEY = process.env.API_KEY;

// Middleware to check session
function isAuthenticated(req, res, next) {
    if (req.session.isAuthenticated) return next();
    res.status(401).send('Unauthorized');
}

// Step 1: Start login
app.get('/ssologin', (req, res) => {
    const authCodeUrlParameters = {
        scopes: ["email", "offline_access", "openid", "profile"],
        redirectUri: REDIRECT_URI,
    };

    cca.getAuthCodeUrl(authCodeUrlParameters)
        .then((response) => res.redirect(response))
        .catch((error) => {
            console.error("Error getting auth code URL:", error);
            res.status(500).send("Internal server error");
        });
});

// Step 2: Handle Azure redirect
app.get('/redirect', (req, res) => {
    const tokenRequest = {
        code: req.query.code,
        scopes: ["email", "offline_access", "openid", "profile"],
        redirectUri: REDIRECT_URI,
    };

    cca.acquireTokenByCode(tokenRequest)
        .then((response) => {
            req.session.isAuthenticated = true;
            req.session.email = response.account.username;
            console.log(`Authenticated session for: ${req.session.email}`);
            console.log(`Login from IP: ${req.ip}, User-Agent: ${req.get('User-Agent')}`);

            res.redirect('/redirect-to-auth');
        })
        .catch((error) => {
            console.error("Error acquiring token:", error);
            res.status(500).send("Internal server error");
        });
});

// Step 3: Secure auth and user setup
app.get('/redirect-to-auth', isAuthenticated, async (req, res) => {
    const email = req.session.email;

    if (!email || !validator.isEmail(email)) {
        return res.status(400).json({ message: 'Invalid or missing session email' });
    }

    const emailDomain = email.split('@')[1];
    const allowedDomains = process.env.ALLOWED_EMAIL_DOMAINS?.split(',') || [];

    if (allowedDomains.length && !allowedDomains.includes(emailDomain)) {
        return res.status(403).json({ message: 'Email domain not allowed' });
    }

    const username = email.split('@')[0];
    let user;

    try {
        const { data: userList } = await axios.get(`${ANYTHINGLLM_BASE_URL}/api/v1/users/`, {
            headers: { Authorization: `Bearer ${API_KEY}` },
        });

        user = userList.users.find(u => u.username === username);

        if (!user) {
            const password = crypto.randomBytes(16).toString('hex');

            await axios.post(`${ANYTHINGLLM_BASE_URL}/api/v1/admin/users/new`, {
                username: username,
                password,
                role: 'default',
            }, {
                headers: { Authorization: `Bearer ${API_KEY}` },
            });

            const { data: updatedUsers } = await axios.get(`${ANYTHINGLLM_BASE_URL}/api/v1/users/`, {
                headers: { Authorization: `Bearer ${API_KEY}` },
            });

            user = updatedUsers.users.find(u => u.username === username);
            if (!user) throw new Error('User created but not found.');
            console.log(`Created user: ${user.username}`);
        } else {
            console.log(`User already exists: ${user.username}`);
        }

        // Add user to workspace(s)
        const workspaceSlugs = process.env.WORKSPACE_SLUG?.split(',').map(s => s.trim()) || [];

        for (const slug of workspaceSlugs) {
            const { data: workspaceData } = await axios.get(`${ANYTHINGLLM_BASE_URL}/api/v1/workspace/${slug}`, {
                headers: { Authorization: `Bearer ${API_KEY}` },
            });

            const workspace = workspaceData.workspace?.[0];
            if (!workspace) {
                console.warn(`No workspace found for slug "${slug}"`);
                continue;
            }

            const { data: userResponse } = await axios.get(`${ANYTHINGLLM_BASE_URL}/api/v1/admin/workspaces/${workspace.id}/users`, {
                headers: { Authorization: `Bearer ${API_KEY}` },
            });

            const workspaceUsers = Array.isArray(userResponse) ? userResponse : userResponse.users;

            const isInWorkspace = workspaceUsers?.some(u =>
                u.userId === user.id || u.username === user.username
            );

            if (!isInWorkspace) {
                await axios.post(`${ANYTHINGLLM_BASE_URL}/api/v1/admin/workspaces/${slug}/manage-users`, {
                    userIds: [user.id],
                    reset: false
                }, {
                    headers: { Authorization: `Bearer ${API_KEY}` },
                });

                console.log(`User ${user.username} added to "${slug}"`);
            } else {
                console.log(`User ${user.username} already in "${slug}"`);
            }
        }

        // Issue token
        const { data: tokenData } = await axios.get(`${ANYTHINGLLM_BASE_URL}/api/v1/users/${user.id}/issue-auth-token`, {
            headers: { Authorization: `Bearer ${API_KEY}` },
        });

        const redirectUrl = `${ANYTHINGLLM_BASE_URL}${tokenData.loginPath}`;

        delete req.session.email; // Clean up session
        res.redirect(redirectUrl);

    } catch (error) {
        if (error.response) {
            console.error('API error:', error.response.data);
        } else {
            console.error('Unexpected error:', error);
        }
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Optional: force HTTPS in production
if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
        if (req.headers['x-forwarded-proto'] !== 'https') {
            return res.redirect(`https://${req.headers.host}${req.url}`);
        }
        next();
    });
}

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: 'Internal server error' });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});