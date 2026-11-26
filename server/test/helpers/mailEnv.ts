/** Turns mail on for one test file. Import before anything that loads AppService. */
process.env.SMTP_HOST = "smtp.test.invalid";
process.env.SMTP_FROM = "Vaultisse <library@example.com>";
process.env.FRONT_END_URL = "http://localhost:5173";
