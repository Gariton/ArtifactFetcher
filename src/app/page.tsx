import { ManagerCatalog } from "@/components/ManagerCatalog";
import { Center, Stack, Text, Title } from "@mantine/core";
import Image from "next/image";

export default function Home() {
    return (
        <Stack gap={48} pb="xl">
            <Stack align="center" gap="md" pt="xl" pb="sm">
                <Image alt="icon" width={120} height={120} src="/icon.png" />
                <Title order={1} ta="center" style={{ letterSpacing: "-0.02em" }}>
                    Artifact Fetcher
                </Title>
                <Center>
                    <Text ta="center" c="var(--af-muted)" fz={16} lh={1.6} maw={560}>
                        外部レジストリの成果物を依存関係ごとサーバー側で取得。閉域環境へ
                        <Text span c="var(--af-text)"> 1 つのアーカイブ</Text>
                        で運ぶか、社内レジストリへ直接 push。
                    </Text>
                </Center>
            </Stack>

            <ManagerCatalog />
        </Stack>
    );
}
