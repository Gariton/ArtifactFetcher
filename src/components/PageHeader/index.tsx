import { Group, Stack, Text, Title } from "@mantine/core";
import { AccentTile } from "../AccentTile";
import { MANAGERS_BY_ID, type ManagerId } from "../managers";
import { ReactNode } from "react";

export function PageHeader({
    manager,
    description,
}: {
    manager: ManagerId;
    description: ReactNode;
}) {
    const m = MANAGERS_BY_ID[manager];
    return (
        <Group align="center" gap="md" wrap="nowrap" mb="lg">
            <AccentTile color={m.color} code={m.code} size="xl" />
            <Stack gap={4}>
                <Title order={1} fz={28} style={{ letterSpacing: "-0.02em", lineHeight: 1.1 }}>
                    {m.label}
                </Title>
                <Text fz={14} c="var(--af-muted)">
                    {description}
                </Text>
            </Stack>
        </Group>
    );
}
