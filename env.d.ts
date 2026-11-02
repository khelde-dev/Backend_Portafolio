declare namespace NodeJS {
  interface ProcessEnv {
    API_TOKEN: string;
    TURSO_DATABASE_URL: string;
    TURSO_AUTH_TOKEN: string;
    ADMIN_JWT_SECRET: string;
  }
}
