'use client';
import { Group, Anchor, ActionIcon, useMantineColorScheme, Burger } from "@mantine/core";
import { IconBrandGithubFilled, IconMoon, IconSun } from "@tabler/icons-react";
import classes from "./styles.module.css";
import { AppTitle } from "../AppTitle";

export const AppHeader = ({
    navbarOpened,
    toggleNavbar
}: {
    navbarOpened: boolean;
    toggleNavbar: ()=>void;
}) => {

    const { setColorScheme } = useMantineColorScheme();

    return (
        <Group
            justify="space-between"
            h={60}
        >
            <Group
                align="center"
            >
                <Burger
                    size="sm"
                    hiddenFrom="xs"
                    onClick={toggleNavbar}
                    opened={navbarOpened}
                />
                <AppTitle />
            </Group>
            <Group>
                <Anchor
                    href="/docker"
                    className={classes.link}
                    visibleFrom="xs"
                >
                    Docker
                </Anchor>
                <Anchor
                    href="/npm"
                    className={classes.link}
                    visibleFrom="xs"
                >
                    npm
                </Anchor>
                <ActionIcon
                    variant="transparent"
                    color="gray"
                    component="a"
                    href="https://github.com/Gariton/ArtifactFetcher"
                    target="_blank"
                >
                    <IconBrandGithubFilled
                        size="1.3em"
                    />
                </ActionIcon>
                <ActionIcon
                    variant="default"
                    color="gray"
                    onClick={()=>setColorScheme("light")}
                    radius="md"
                    lightHidden
                >
                    <IconSun size="1rem"/>
                </ActionIcon>
                <ActionIcon
                    variant="default"
                    color="gray"
                    onClick={()=>setColorScheme("dark")}
                    radius="md"
                    darkHidden
                >
                    <IconMoon size="1rem"/>
                </ActionIcon>
            </Group>
        </Group>
    );
}