import { Anchor, Stack } from "@mantine/core";
import classes from "./styles.module.css";

export const AppNavbar = () => {
    return (
        <Stack
            p="md"
        >
            <Anchor
                className={classes.link}
                href="/docker"
            >
                Docker
            </Anchor>
            <Anchor
                className={classes.link}
                href="/npm"
            >
                npm
            </Anchor>
            <Anchor
                className={classes.link}
                href="/pip"
            >
                pip
            </Anchor>
            <Anchor
                className={classes.link}
                href="/admin"
            >
                管理
            </Anchor>
        </Stack>
    );
}
