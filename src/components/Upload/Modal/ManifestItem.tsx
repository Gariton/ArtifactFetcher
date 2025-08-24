import { LayerCard } from "@/components/LayerCard";
import { Layer } from "@/lib/progressBus";
import { Accordion, Center, Flex, RingProgress, ScrollArea, Stack, Text } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { memo, useMemo } from "react";

type ManifestItemProps = {
    name: string;
    layers: Layer[];
    layerProgress: Record<number, {received: number; total?: number; status: "process"|"done"|"skipped";}>;
}

export const ManifestItem = memo(function ManifestItemMemo ({
    name,
    layers,
    layerProgress
}: ManifestItemProps) {

    const manifestPct = useMemo(() => {
        const doneLayers = Array.from(Object.values(layerProgress!).values().filter(l=>l.status=="done"||l.status=="skipped")).length;
        return layers.length > 0 ? Math.floor((doneLayers / layers.length) * 100) : 0;
    }, [layerProgress, layers]);

    return (
        <Accordion.Item
            key={name}
            value={name}
        >
            <Accordion.Control>
                <Flex
                    gap="sm"
                    align="center"
                >
                    <RingProgress
                        sections={[{
                            value: manifestPct,
                            color: "green"
                        }]}
                        size={50}
                        thickness={5}
                        label={manifestPct >= 100 ? (
                            <Center>
                                <IconCheck
                                    size="1.3em"
                                    stroke={3}
                                />
                            </Center>
                        ) : (
                            <Text
                                size="xs"
                                ta="center"
                            >
                                {manifestPct}%
                            </Text>
                        )}
                    />
                    <div>
                    <Text>
                        {name}
                    </Text>
                    <Text
                        size="sm"
                        c="dimmed"
                    >
                        {layers.length} Layers
                    </Text>
                </div>
                </Flex>
            </Accordion.Control>
            <Accordion.Panel>
                <ScrollArea
                    h={500}
                >
                    <Stack>
                        {layers.map((layer, j) => {
                            const info = (layerProgress ?? {})[j];
                            const pct = info?.total ? Math.floor((info.received / info.total) * 100) : undefined;
                            return (
                                <LayerCard
                                    key={j}
                                    number={j}
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
            </Accordion.Panel>
        </Accordion.Item>
    )
})