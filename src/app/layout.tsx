'use client';
import { Text, AppShell, Container, MantineProvider } from "@mantine/core";
import { ReactNode } from "react";

import "@mantine/core/styles.css";
import { AppHeader } from "@/components/Header";
import { useDisclosure } from "@mantine/hooks";
import { AppNavbar } from "@/components/Navbar";

export default function Layout({
    children
}: Readonly<{
    children: ReactNode
}>) {
    const [opened, {toggle}] = useDisclosure(false);

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
                        navbar={{
                            width: 150,
                            breakpoint: "xs",
                            collapsed: {desktop: true, mobile: !opened}
                        }}
                        footer={{
                            height: 40
                        }}
                    >
                        <AppShell.Header>
                            <Container
                                size="md"
                            >
                                <AppHeader
                                    navbarOpened={opened}
                                    toggleNavbar={toggle}
                                />
                            </Container>
                        </AppShell.Header>
                        <AppShell.Navbar
                            hiddenFrom="xs"
                        >
                            <AppNavbar />
                        </AppShell.Navbar>
                        <AppShell.Main>
                            <Container
                                size="md"
                                py="lg"
                            >
                                {children}
                            </Container>
                        </AppShell.Main>
                        <AppShell.Footer
                            withBorder={false}
                        >
                            <Text
                                ta="center"
                            >
                                © 2025 Gariton_
                            </Text>
                        </AppShell.Footer>
                    </AppShell>
                </MantineProvider>
            </body>
        </html>
    );
}