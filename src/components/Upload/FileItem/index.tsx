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
                            value: percent,
                            color: "green"
                        }
                    ]}
                    label={
                        <Center>
                            {status == "done" && (
                                <IconCheck
                                    size="1.3em"
                                    stroke={3}
                                />
                            )}
                            {status == "processing" && (
                                <Text
                                    size="xs"
                                >
                                    {percent}%
                                </Text>
                            )}  
                            {(status == undefined || status == "waiting") && (
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
                    <Text size="sm">{file.name}</Text>
                    <Text size="xs" c="dimmed">{(file.size / 1_000_000).toFixed(2)}MB</Text>
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