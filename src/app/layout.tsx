'use client';
import { ActionIcon, Anchor, AppShell, Container, Group, MantineProvider, Title } from "@mantine/core";
import { ReactNode } from "react";

import "@mantine/core/styles.css";
import { IconBrandGithubFilled } from "@tabler/icons-react";

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
                                    <Anchor
                                        variant="text"
                                        c="dark"
                                        td="none"
                                        href="/"
                                    >
                                        <Title
                                            order={3}
                                        >
                                            Downloader
                                        </Title>
                                    </Anchor>
                                    <Group>
                                        <Anchor href="/docker">
                                            Docker
                                        </Anchor>
                                        <Anchor href="/npm">
                                            npm
                                        </Anchor>
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