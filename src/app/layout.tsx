'use client';
import { ActionIcon, AppShell, Container, Group, MantineProvider, Title } from "@mantine/core";
import { ReactNode } from "react";

import "@mantine/core/styles.css";
import { IconBrandGithub, IconBrandGithubFilled } from "@tabler/icons-react";

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
                                    <ActionIcon
                                        variant="transparent"
                                        color="gray"
                                        component="a"
                                        href="https://github.com/Gariton/getDockerImageViaAPI"
                                        target="_blank"
                                    >
                                        <IconBrandGithubFilled
                                            size="1.3em"
                                        />
                                    </ActionIcon>
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