import { AnchorCard } from "@/components/AnchorCard";
import { Center, Container, Space, Stack, ThemeIcon, Title } from "@mantine/core";
import { IconBrandDocker, IconBrandNpm, IconBrandPython } from "@tabler/icons-react";
import Image from "next/image";

const apps = [
    {
        title: "Docker Image",
        description: "Docker HUBのAPIを使用して安全かつ高速にDocker Imageをtarball形式でダウンロードすることができます。",
        href: "/docker",
        icon: <ThemeIcon
            variant="transparent"
            size={70}
        >
            <IconBrandDocker
                style={{width: '70%', height: '70%'}}
                stroke={1.3}
            />
        </ThemeIcon>
    },
    {
        title: "npm package",
        description: "npm.jsの公式レジストリを使用してnpmのない環境でも依存関係を網羅したパッケージをダウンロードすることができます。",
        href: "/npm",
        icon: <ThemeIcon
            variant="transparent"
            size={70}
            color="red"
        >
            <IconBrandNpm
                style={{width: '70%', height: '70%'}}
                stroke={1.3}
            />
        </ThemeIcon>
    },
    {
        title: "pip package",
        description: "coming soon...",
        href: "",
        icon: <ThemeIcon
            variant="transparent"
            size={70}
            color="violet"
        >
            <IconBrandPython
                style={{width: '70%', height: '70%'}}
                stroke={1.3}
            />
        </ThemeIcon>
    }
]

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
                {apps.map((app, i) => (
                    <AnchorCard
                        key={i}
                        {...app}
                    />
                ))}
            </Stack>
        </Container>
    );
}