import { MantineProvider, ColorSchemeScript, mantineHtmlProps } from "@mantine/core";
import { ReactNode } from "react";
import { DefalutLayout } from "@/components/Layout/default";
import { theme } from "../../theme";

export default function Layout({
    children
}: Readonly<{
    children: ReactNode
}>) {
    return (
        <html
            lang="en"
            {...mantineHtmlProps}
        >
            <head>
                <ColorSchemeScript defaultColorScheme="auto"/>
                <meta
                    name="viewport"
                    content="minimum-scale=1, initial-scale=1, width=device-width, user-scalable=no"
                />
                {process.env.NODE_ENV == "development" && (
                    <script
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