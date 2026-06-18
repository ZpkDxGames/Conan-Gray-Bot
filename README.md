# Conan Gray Bot Dashboard

This folder can be deployed directly to Vercel as a static dashboard.

Backend API target:

```txt
https://conanbot.discloud.app
```

On first load, the dashboard reads defaults from `assets/config.js`. You can still override them from the lock screen by pasting:

- the Discloud backend URL;
- the dashboard key configured as `DASHBOARD_SESSION_KEY`;
- the guild ID.

The dashboard stores those values in the browser local storage and sends the key as `X-Dashboard-Key` to the backend API.
