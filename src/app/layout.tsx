'use client';
import { AppShell, Container, MantineProvider } from "@mantine/core";
import { ReactNode } from "react";

import "@mantine/core/styles.css";
import { AppHeader } from "@/components/Header";

export default function Layout({
    children
}: Readonly<{
    children: ReactNode
}>) {
    return (
        <html
            lang="ja"
        >
            <body>
                <MantineProvider>
                    <AppShell
                        header={{
                            height: 60
                        }}
                    >
                        <AppShell.Header>
                            <Container
                                size="md"
                            >
                                <AppHeader />
                            </Container>
                        </AppShell.Header>
                        <AppShell.Main>
                            <Container
                                size="md"
                                py="lg"
                            >
                                {children}
                            </Container>
                        </AppShell.Main>
                    </AppShell>
                </MantineProvider>
            </body>
        </html>
    );
}