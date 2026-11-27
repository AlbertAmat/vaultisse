/** Turns the admin portal on for one test file. Import before anything that loads AppService. */
process.env.ADMIN_ENABLED = "true";
process.env.ADMIN_PORT = "0"; // any free port, like API_PORT in testEnv.js
process.env.ADMIN_URL = "";
process.env.ADMIN_ALLOWED_IPS = "";
