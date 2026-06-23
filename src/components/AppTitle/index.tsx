import { Group, Text } from "@mantine/core";
import Link from "next/link";
import { AccentTile } from "../AccentTile";
import classes from "./styles.module.css";

export const AppTitle = () => {
    return (
        <Link href="/" className={classes.title}>
            <Group gap="xs" wrap="nowrap">
                <AccentTile color="docker" code="AF" size="md" />
                <Text
                    fw={600}
                    fz={15}
                    style={{ letterSpacing: "-0.01em" }}
                    visibleFrom="xs"
                >
                    Artifact Fetcher
                </Text>
            </Group>
        </Link>
    );
}
