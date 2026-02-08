import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

const handler = NextAuth({
    providers: [
        CredentialsProvider({
            name: 'Brain Web',
            credentials: {
                email: { label: "Email", type: "email", placeholder: "you@example.com" },
                password: { label: "Password", type: "password" }
            },
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.password) {
                    return null;
                }

                try {
                    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000'}/auth/login`, {
                        method: 'POST',
                        body: JSON.stringify({
                            email: credentials.email,
                            password: credentials.password,
                        }),
                        headers: { "Content-Type": "application/json" }
                    });

                    const data = await res.json();

                    if (res.ok && data.access_token) {
                        // Return user object with token embedded
                        return {
                            id: data.user.user_id,
                            name: data.user.full_name,
                            email: data.user.email,
                            tenantId: data.user.tenant_id,
                            accessToken: data.access_token,
                        };
                    }
                    return null;
                } catch (error) {
                    console.error('[NextAuth] Authorize error:', error);
                    return null;
                }
            }
        })
    ],
    callbacks: {
        async jwt({ token, user, account }) {
            // Persist the OAuth access_token and or the user id to the token
            if (user) {
                token.id = user.id;
                token.tenantId = (user as any).tenantId;
                token.accessToken = (user as any).accessToken;
            }
            return token;
        },
        async session({ session, token }) {
            // Send properties to the client
            if (token) {
                (session as any).user.id = token.id;
                (session as any).user.tenantId = token.tenantId;
                (session as any).accessToken = token.accessToken;
            }
            return session;
        }
    },
    pages: {
        signIn: '/login',
        error: '/login',
    },
    session: {
        strategy: 'jwt',
        maxAge: 30 * 24 * 60 * 60, // 30 days
    },
});

export { handler as GET, handler as POST };
