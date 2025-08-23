import { Card, Group, Text, Loader, ThemeIcon, Stack, Progress, Badge } from "@mantine/core";
import { IconArrowRightDashed, IconCircleCheck } from "@tabler/icons-react";
import { memo } from "react";

export const LayerCard = memo(function LayerCardMemo({
    number,
    sha,
    progress,
    total,
    received,
    status
}: {
    number: number;
    sha: string;
    progress: number;
    total: number;
    received: number;
    status: "process"|"done"|"skipped"
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
                        {status == "done" && (
                            <ThemeIcon
                                variant="transparent"
                            >
                                <IconCircleCheck
                                    color="green"
                                    size="1rem"
                                />
                            </ThemeIcon>
                        )}
                        {status == "process" && (
                            <Loader size="xs"/>
                        )}
                        {status == "skipped" && (
                            <Badge
                                leftSection={<IconArrowRightDashed size="1em"/>}
                                color="yellow"
                                size="xs"
                            >
                                skipped
                            </Badge>
                        )}
                    </Group>
                    {status !== "skipped" && (
                        <Text
                            size="xs"
                            c="dimmed"
                        >
                            {(total / 1_000_000).toFixed(2)}MB
                        </Text>
                    )}
                </Group>

                <div>
                    <Text
                        size="xs"
                        lineClamp={1}
                    >
                        {sha}
                    </Text>
                    {status !== "skipped" && (
                        <Progress
                            value={progress}
                        />
                    )}
                </div>
                {status !== "skipped" && (
                    <Text
                        c="dimmed"
                        size="xs"
                    >
                        {(received / 1_000_000).toFixed(2)}MB / {(total / 1_000_000).toFixed(2)}MB
                    </Text>
                )}
            </Stack>
            
        </Card>
    );
});