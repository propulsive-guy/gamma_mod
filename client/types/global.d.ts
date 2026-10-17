declare global {
    var mongoose: {
        conn: any;
        promise: any;
    };

    namespace NodeJS {
        interface ProcessEnv {
            MONGODB_URI: string;
            NEXTAUTH_SECRET: string;
            AUTH_SECRET: string;
            BACKEND_URL: string;
            NEXT_PUBLIC_BASE_URL: string;
            SIGNUP_SECRET_KEY: string;
        }
    }
}

export { };
