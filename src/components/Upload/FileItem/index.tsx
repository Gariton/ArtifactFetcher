import { ActionIcon, Card, Center, Flex, RingProgress, Text } from "@mantine/core";
import { IconCheck, IconFileNeutral, IconX } from "@tabler/icons-react";
import { memo } from "react";
export const FileItem = memo(function FileItemMemo ({
    file,
    status,
    percent,
    onDelete,
    loading=false,
    disabled=false
}: {
    file: File;
    status: string;
    percent: number;
    onDelete: (f: File)=>void;
    loading?: boolean;
    disabled?: boolean;
}) {
    const showCheck = status === 'done' || status === 'published' || status === 'skipped';
    const showProgress = ['processing', 'uploading', 'publishing'].includes(status);
    const isError = status === 'error';
    const showIdle = !status || ['waiting'].includes(status);
    const ringColor = isError ? 'npm' : 'success';

    return (
        <Card
            withBorder
            radius="lg"
            style={{cursor: "pointer"}}
            p="xs"
        >
            <Flex gap="sm" align="center">
                <RingProgress
                    sections={[
                        {
                            value: isError ? 100 : percent,
                            color: ringColor
                        }
                    ]}
                    label={
                        <Center>
                            {isError && (
                                <IconX
                                    size="1.3em"
                                    stroke={3}
                                    color="var(--af-error)"
                                />
                            )}
                            {showCheck && (
                                <IconCheck
                                    size="1.3em"
                                    stroke={3}
                                />
                            )}
                            {showProgress && !showCheck && (
                                <Text
                                    size="xs"
                                >
                                    {percent}%
                                </Text>
                            )}  
                            {showIdle && (
                                <IconFileNeutral
                                    size="1.3em"
                                />
                            )}
                        </Center>
                    }
                    size={50}
                    thickness={3}
                />
                <div
                    style={{flex: 1}}
                >
                    <Text size="sm" ff="monospace" style={{ wordBreak: "break-all" }}>{file.name}</Text>
                    <Text size="xs" c="dimmed" ff="monospace">{(file.size / 1_000_000).toFixed(2)}MB</Text>
                </div>
                <ActionIcon
                    variant="transparent"
                    c={loading ? "dimmed" : "red"}
                    onClick={()=>onDelete(file)}
                    disabled={loading||disabled}
                >
                    <IconX size="1.3em"/>
                </ActionIcon>
            </Flex>
        </Card>
    );
});
