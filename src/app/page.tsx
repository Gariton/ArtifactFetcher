import { Anchor, Title } from "@mantine/core";

export default function Home() {
    return (
        <div>
            <Title
                ta="center"
            >
                Downloader
            </Title>
            <Anchor href="/docker">Docker</Anchor>
            <Anchor href="/npm">NPM</Anchor>
        </div>
    );
}