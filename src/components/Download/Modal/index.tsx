import { LayerCard } from "@/components/LayerCard";
import { Layer } from "@/lib/progressBus";
import { Badge, Button, Center, Group, Loader, Modal, ModalProps, Progress, ScrollArea, Stack, Text } from "@mantine/core";
import { IconCircleCheck, IconDownload, IconStackFront } from "@tabler/icons-react";
import { memo } from "react";

type DownloadModalType = {
    repo: string;
    tag: string;
    status: string;
    layers: Layer[];
    perLayer: Record<number, { received: number; total?: number; status: "process"|"done"|"skipped"; }>;
    jobId: string|null;
} & ModalProps;

export const DownloadModal = memo(function DownloadModalMemo({
    repo,
    tag,
    status,
    jobId,
    layers,
    perLayer,
    ...props
}: DownloadModalType) {

    const totals = Object.values(perLayer).reduce(
        (acc, v) => {
            acc.received += v.received || 0; acc.total! += v.total || 0; return acc;
        },
        { received: 0, total: 0 }
    );
    const overallPercent = totals.total! > 0 ? Math.floor((totals.received / totals.total!) * 100) : undefined;

    return (
        <Modal
            {...props}
            centered
            radius="lg"
            size="lg"
            transitionProps={{transition: "pop"}}
            withCloseButton={false}
        >
            <Group
                justify="space-between"
            >
                <Group
                    gap="xs"
                >
                    <IconStackFront />
                    <Text
                        fw="bold"
                        size="lg"
                    >
                        ダウンロード進捗
                    </Text>
                </Group>
                <Text
                    size="xs"
                >
                    {jobId}
                </Text>
            </Group>

            <Group
                justify="space-between"
            >
                <Text
                    size="sm"
                    c="dimmed"
                >
                    {repo}:{tag}・{layers.length}Layers
                </Text>
                {status=="done" ? (
                    <Badge
                        leftSection={<IconCircleCheck size="1em"/>}
                        color="green"
                        radius="sm"
                    >
                        done
                    </Badge>
                ):(
                    <Badge
                        leftSection={<Loader size="1em" color="white"/>}
                        color="gray"
                        radius="sm"
                    >
                        {status}
                    </Badge>
                )}
            </Group>

            <Stack
                py="md"
                gap={10}
            >
                <Group
                    justify="space-between"
                >
                    <Text
                        fw="bold"
                    >
                        全体の進捗
                    </Text>
                    <Text>
                        {overallPercent}%
                    </Text>
                </Group>
                <Progress
                    value={overallPercent || 0}
                    size="lg"
                />
                <Text
                    color="dimmed"
                    size="xs"
                >
                    {(totals.received / 1_000_000).toFixed(2)}MB / {((totals.total ?? 0) / 1_000_000).toFixed(2)}MB
                </Text>
            </Stack>

            {status=="starting"||status=="running" ? (
                <Center
                    h={400}
                >
                    <Loader />
                </Center>
            ) : (
                <ScrollArea
                    h={400}
                >
                    <Stack>
                        {layers.map((layer, i) => {
                            const info = perLayer[i];
                            const pct = info?.total ? Math.floor((info.received / info.total) * 100) : undefined;
                            return (
                                <LayerCard
                                    key={i}
                                    number={i}
                                    progress={pct || 0}
                                    sha={layer.digest}
                                    total={info?.total || 0}
                                    received={info?.received || 0}
                                    status={info?.status || "process"}
                                />
                            )
                        })}
                    </Stack>
                </ScrollArea>
            )}

            <Button
                leftSection={<IconDownload size="1rem"/>}
                fullWidth
                radius="lg"
                mt="lg"
                color="dark"
                disabled={jobId==null || status!="done"}
                component="a"
                href={`/api/build/download?jobId=${jobId}`}
                target="_blank"
            >
                ダウンロード
            </Button>
        </Modal>
    );
});