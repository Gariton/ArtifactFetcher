import { Group, Text } from "@mantine/core";
import Image from "next/image";
import Link from "next/link";
import classes from "./styles.module.css";

export const AppTitle = () => {
    return (
        <Link href="/" className={classes.title}>
            <Group gap="xs" wrap="nowrap">
                <Image alt="icon" width={34} height={34} src="/icon.png" />
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
