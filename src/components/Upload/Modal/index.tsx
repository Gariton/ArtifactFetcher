import { Accordion, Button, Flex, Group, Modal, ScrollArea, Text } from "@mantine/core";
import { IconStackFront } from "@tabler/icons-react";
import { memo } from "react";
import { ManifestItem } from "./ManifestItem";
import { Layer } from "@/lib/progressBus";

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
                >
                    <Group
                        gap="xs"
                    >
                        <IconStackFront />
                        <Text
                            fw="bold"
                            size="lg"
                        >
                            アップロード進捗
                        </Text>
                    </Group>
                    <Text
                        size="xs"
                    >
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
                    color="dark"
                    radius="md"
                    size="md"
                    fullWidth
                    onClick={onClose}
                >
                    とじる
                </Button>
            </Flex>
        </Modal>
    );
})