import { Group, Anchor, Title, ActionIcon, useMantineColorScheme } from "@mantine/core";
import { IconBrandGithubFilled, IconMoon, IconSun } from "@tabler/icons-react";

import classes from "./styles.module.css";

export const AppHeader = () => {

    const { toggleColorScheme, colorScheme } = useMantineColorScheme();

    return (
        <Group
            justify="space-between"
            h={60}
        >
            <Anchor
                variant="text"
                td="none"
                href="/"
            >
                <Title
                    order={3}
                >
                    Artifact Fetcher
                </Title>
            </Anchor>
            <Group>
                <Anchor
                    href="/docker"
                    className={classes.link}
                >
                    Docker
                </Anchor>
                <Anchor
                    href="/npm"
                    className={classes.link}    
                >
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
                <ActionIcon
                    variant="default"
                    color="gray"
                    onClick={toggleColorScheme}
                    radius="md"
                >
                    {colorScheme == "dark" ? (
                        <IconSun size="1rem"/>
                    ) : (
                        <IconMoon size="1rem"/>
                    )}
                </ActionIcon>
            </Group>
        </Group>
    );
}