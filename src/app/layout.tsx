import { MantineProvider, ColorSchemeScript, mantineHtmlProps } from "@mantine/core";
import { ReactNode } from "react";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { DefalutLayout } from "@/components/Layout/default";
import { theme } from "../../theme";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
    subsets: ["latin"],
    weight: ["300", "400", "500", "600", "700"],
    variable: "--font-plex-sans",
    display: "swap",
});

const plexMono = IBM_Plex_Mono({
    subsets: ["latin"],
    weight: ["400", "500", "600"],
    variable: "--font-plex-mono",
    display: "swap",
});

export default function Layout({
    children
}: Readonly<{
    children: ReactNode
}>) {
    return (
        <html
            lang="en"
            {...mantineHtmlProps}
            className={`${plexSans.variable} ${plexMono.variable}`}
        >
            <head>
                <ColorSchemeScript defaultColorScheme="auto"/>
                <meta
                    name="viewport"
                    content="minimum-scale=1, initial-scale=1, width=device-width, user-scalable=no"
                />
                {process.env.NODE_ENV == "development" && (
                    <script
                        async
                        crossOrigin="anonymous"
                        src="https://unpkg.com/react-scan/dist/auto.global.js"
                    />
                )}
            </head>
            <body>
                <MantineProvider
                    theme={theme}
                    defaultColorScheme="auto"
                >
                    <DefalutLayout>
                        {children}
                    </DefalutLayout>
                </MantineProvider>
            </body>
        </html>
    );
}
