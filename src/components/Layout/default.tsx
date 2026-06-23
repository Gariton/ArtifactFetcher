'use client';
import { Text, AppShell, Container, Flex, Group } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { ReactNode } from "react";

import "@mantine/core/styles.css";
import "@mantine/dropzone/styles.css";
import "@mantine/notifications/styles.css";
import { AppHeader } from "@/components/Header";
import { useDisclosure } from "@mantine/hooks";
import { AppNavbar } from "@/components/Navbar";

export const DefalutLayout = ({
    children
}: {children: ReactNode}) => {
    const [opened, {toggle, close}] = useDisclosure(false);
    return (
        <>
            <Notifications position="top-right" />
            <AppShell
            header={{
                height: 60
            }}
            navbar={{
                width: 260,
                breakpoint: "sm",
                collapsed: {desktop: true, mobile: !opened}
            }}
        >
            <AppShell.Header
                style={{ borderBottom: "1px solid var(--af-border)", background: "var(--af-bg)" }}
            >
                <Container
                    size="md"
                    h="100%"
                >
                    <AppHeader
                        navbarOpened={opened}
                        toggleNavbar={toggle}
                    />
                </Container>
            </AppShell.Header>
            <AppShell.Navbar
                hiddenFrom="sm"
                style={{ background: "var(--af-surface)", borderRight: "1px solid var(--af-border)" }}
                onClick={close}
            >
                <AppNavbar />
            </AppShell.Navbar>
            <AppShell.Main>
                <Flex
                    direction="column"
                    gap="lg"
                    mih="calc(100vh - 60px)"
                >
                    <Container
                        size="md"
                        pt="xl"
                        flex={1}
                        w="100%"
                    >
                        {children}
                    </Container>
                    <Group
                        h={56}
                        px="md"
                        justify="space-between"
                        style={{ borderTop: "1px solid var(--af-border)" }}
                    >
                        <Text className="af-mono" fz={11} c="var(--af-dim)">
                            © 2025 Gariton_
                        </Text>
                        <Text className="af-mono" fz={11} c="var(--af-dim)" visibleFrom="xs">
                            air-gapped registry mirror
                        </Text>
                    </Group>
                </Flex>
            </AppShell.Main>
            </AppShell>
        </>
    );
}
