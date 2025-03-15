import { dotenv } from 'dotenv';
dotenv.config();

module.exports = {
  "installed": {
    "client_id": import.meta.CLIENT_ID,
    "project_id": "bcsd-online-meeting",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_secret": import.meta.CLIENT_SECRET,
    "redirect_uris": [
      "http://localhost"
    ]
  }
}