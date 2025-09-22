'use client';
import { ManagerCatalog, type ManagerEntry } from "@/components/ManagerCatalog";
import { Center, Container, Space, Stack, Title } from "@mantine/core";
import { IconBrandDocker, IconBrandNpm, IconBrandPython } from "@tabler/icons-react";
import Image from "next/image";

const managers: ManagerEntry[] = [
    {
        id: "docker",
        name: "Docker Image",
        description: "Docker HUBのAPIを使用して安全かつ高速にDocker Imageをtarball形式でダウンロードすることができます。",
        href: "/docker",
        Icon: IconBrandDocker,
        color: "blue",
    },
    {
        id: "npm",
        name: "npm package",
        description: "npm.jsの公式レジストリを使用してnpmのない環境でも依存関係を網羅したパッケージをダウンロードすることができます。",
        href: "/npm",
        Icon: IconBrandNpm,
        color: "red",
    },
    {
        id: "pip",
        name: "pip package",
        description: "PyPI や社内レジストリから pip パッケージをまとめて取得し、任意のレジストリにアップロードできます。",
        href: "/pip",
        Icon: IconBrandPython,
        color: "violet",
    },
];

export default function Home() {
    return (
        <Container
            size="sm"
        >
            <Center>
                <Image
                    alt="icon"
                    src="/icon.png"
                    width={170}
                    height={170}
                />
            </Center>
            <Title
                ta="center"
            >
                Artifact Fetcher
            </Title>

            <Space h="xl" />

            <Stack>
                <ManagerCatalog entries={managers} />
            </Stack>
        </Container>
    );
}
