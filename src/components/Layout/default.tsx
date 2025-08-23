'use client';
import { Text, AppShell, Container, Flex, Center } from "@mantine/core";
import { ReactNode } from "react";

import "@mantine/core/styles.css";
import "@mantine/dropzone/styles.css";
import { AppHeader } from "@/components/Header";
import { useDisclosure } from "@mantine/hooks";
import { AppNavbar } from "@/components/Navbar";

export const DefalutLayout = ({
    children
}: {children: ReactNode}) => {
    const [opened, {toggle}] = useDisclosure(false);
    return (
        <AppShell
            header={{
                height: 60
            }}
            navbar={{
                width: 150,
                breakpoint: "xs",
                collapsed: {desktop: true, mobile: !opened}
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
                <Flex
                    direction="column"
                    gap="lg"
                    mih="calc(100vh - 60px)"
                >
                    <Container
                        size="md"
                        pt="md"
                        flex={1}
                    >
                        {children}
                    </Container>
                    <Center
                        h={50}
                    >
                        <Text
                            ta="center"
                        >
                            © 2025 Gariton_
                        </Text>
                    </Center>
                </Flex>
            </AppShell.Main>
        </AppShell>
    );
}