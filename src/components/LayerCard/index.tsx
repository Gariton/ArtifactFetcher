import { Card, Group, Text, Loader, ThemeIcon, Stack, Progress } from "@mantine/core";
import { IconCircleCheck } from "@tabler/icons-react";
import { memo } from "react";

export const LayerCard = memo(function LayerCardMemo({
    number,
    sha,
    progress,
    total,
    received
}: {
    number: number;
    sha: string;
    progress: number;
    total: number;
    received: number;
}) {
    return (
        <Card
            withBorder
            radius="md"
        >
            <Stack
                gap={3}
            >
                <Group
                    justify="space-between"
                >
                    <Group>
                        <Text
                            size="sm"
                            span
                        >
                            Layer {number + 1}
                        </Text>
                        {progress >= 100 ? (
                            <ThemeIcon
                                variant="transparent"
                            >
                                <IconCircleCheck
                                    color="green"
                                    size="1rem"
                                />
                            </ThemeIcon>
                        ) : (
                            <Loader size="xs"/>
                        )}
                    </Group>
                    <Text
                        size="xs"
                        c="dimmed"
                    >
                        {(total / 1_000_000).toFixed(2)}MB
                    </Text>
                </Group>

                <div>
                    <Text
                        size="xs"
                        lineClamp={1}
                    >
                        {sha}
                    </Text>
                    <Progress
                        value={progress}
                    />
                </div>

                <Text
                    c="dimmed"
                    size="xs"
                >
                    {(received / 1_000_000).toFixed(2)}MB / {(total / 1_000_000).toFixed(2)}MB
                </Text>
            </Stack>
            
        </Card>
    );
});