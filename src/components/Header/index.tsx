'use client';
import { Group, ActionIcon, useMantineColorScheme, Burger, Box } from "@mantine/core";
import { IconBrandGithubFilled, IconMoon, IconSun } from "@tabler/icons-react";
import { usePathname } from "next/navigation";
import { AppTitle } from "../AppTitle";
import { MANAGERS } from "../managers";
import classes from "./styles.module.css";

export const AppHeader = ({
    navbarOpened,
    toggleNavbar
}: {
    navbarOpened: boolean;
    toggleNavbar: ()=>void;
}) => {

    const { setColorScheme } = useMantineColorScheme();
    const pathname = usePathname();

    return (
        <Group
            justify="space-between"
            h={60}
            wrap="nowrap"
        >
            <Group
                align="center"
                wrap="nowrap"
                gap="md"
            >
                <Burger
                    size="sm"
                    hiddenFrom="sm"
                    onClick={toggleNavbar}
                    opened={navbarOpened}
                />
                <AppTitle />
                <Group
                    gap={4}
                    visibleFrom="sm"
                    ml="xs"
                    wrap="nowrap"
                >
                    {MANAGERS.map((m) => {
                        const active = pathname?.startsWith(m.href);
                        return (
                            <Box
                                key={m.id}
                                component="a"
                                href={m.href}
                                className={classes.navLink}
                                data-active={active || undefined}
                                style={active ? {
                                    color: `var(--af-${m.color})`,
                                    background: `color-mix(in oklch, var(--af-${m.color}) 14%, transparent)`,
                                } : undefined}
                            >
                                {m.label}
                            </Box>
                        );
                    })}
                </Group>
            </Group>
            <Group gap="xs" wrap="nowrap">
                <ActionIcon
                    variant="default"
                    size="lg"
                    radius="md"
                    component="a"
                    href="https://github.com/Gariton/ArtifactFetcher"
                    target="_blank"
                    aria-label="GitHub"
                >
                    <IconBrandGithubFilled size="1.1rem" />
                </ActionIcon>
                <ActionIcon
                    variant="default"
                    size="lg"
                    onClick={()=>setColorScheme("light")}
                    radius="md"
                    lightHidden
                    aria-label="ライトモード"
                >
                    <IconSun size="1.05rem"/>
                </ActionIcon>
                <ActionIcon
                    variant="default"
                    size="lg"
                    onClick={()=>setColorScheme("dark")}
                    radius="md"
                    darkHidden
                    aria-label="ダークモード"
                >
                    <IconMoon size="1.05rem"/>
                </ActionIcon>
            </Group>
        </Group>
    );
}
