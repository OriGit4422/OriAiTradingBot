export function getAuthCredentials(): { validUser: string; validPass: string } {
  const validUser = process.env.AUTH_USERNAME;
  const validPass = process.env.AUTH_PASSWORD;
  if (!validUser || !validPass) {
    throw new Error("AUTH_USERNAME and AUTH_PASSWORD environment variables are required");
  }
  return { validUser, validPass };
}
