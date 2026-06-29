import { Accordion, Button, Flex, Group, Modal, ScrollArea, Text } from "@mantine/core";
import { memo } from "react";
import { ManifestItem } from "./ManifestItem";
import { Layer } from "@/lib/progressBus";
import { AccentTile } from "@/components/AccentTile";

type UploadModalType = {
    jobId: string|null;
    opened: boolean;
    onClose: () => void;
    manifests: Map<string, Layer[]>;
    perLayer: Map<string, Record<number, {received: number; total?: number; status: "process"|"done"|"skipped";}>>;
}

export const UploadModal = memo(function UploadModalMemo ({
    jobId,
    opened,
    onClose,
    manifests,
    perLayer,
}: UploadModalType) {
    return (
        <Modal
            opened={opened}
            onClose={onClose}
            centered
            radius="lg"
            size="lg"
            transitionProps={{transition: "pop"}}
            withCloseButton={false}
            styles={{body: {height: '100%'}}}
        >
            <Flex
                h="100%"
                direction="column"
                gap="sm"
            >
                <Group
                    justify="space-between"
                    wrap="nowrap"
                >
                    <Group gap="sm" wrap="nowrap">
                        <AccentTile color="docker" code="DKR" size="lg" />
                        <div>
                            <Text fw={600} fz={15}>アップロード進捗</Text>
                            <Text className="af-mono" fz={11} c="var(--af-dim)" mt={2}>Registry へ push</Text>
                        </div>
                    </Group>
                    <Text className="af-mono" size="xs" c="var(--af-dim)">
                        {jobId}
                    </Text>
                </Group>

                <ScrollArea
                    h={550}
                >
                    <Accordion
                        radius="md"
                    >
                        {Array.from(manifests.entries()).map(([manifestName]) => {
                            return (
                                <ManifestItem
                                    key={manifestName}
                                    name={manifestName}
                                    layers={manifests.get(manifestName) ?? []}
                                    layerProgress={perLayer.get(manifestName) ?? {}}
                                />
                            );
                        })}
                    </Accordion>
                </ScrollArea>
                <Button
                    variant="default"
                    radius="md"
                    size="md"
                    fullWidth
                    onClick={onClose}
                >
                    閉じる
                </Button>
            </Flex>
        </Modal>
    );
})