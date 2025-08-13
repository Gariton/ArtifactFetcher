'use client';
import { AppShell, Container, Group, MantineProvider, Title } from "@mantine/core";
import { ReactNode } from "react";

import "@mantine/core/styles.css";

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
                                <Group
                                    justify="space-between"
                                    h={60}
                                >
                                    <Title
                                        order={3}
                                    >
                                        Docker Image Downloader
                                    </Title>
                                </Group>
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