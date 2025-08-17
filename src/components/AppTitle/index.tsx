import { Group, Anchor, Title } from "@mantine/core";
import Image from "next/image";
import classes from "./styles.module.css";

export const AppTitle = () => {
    return (
        <Group
            gap={0}
        >
            <Image
                alt="icon"
                width={50}
                height={50}
                src="/icon.png"
            />
            <Anchor
                variant="text"
                td="none"
                href="/"
                className={classes.title}
            >
                <Title
                    order={3}
                >
                    Artifact Fetcher
                </Title>
            </Anchor>
        </Group>
    );
}