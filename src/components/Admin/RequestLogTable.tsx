'use client';

import { Stack, Title, Table, Text, Badge } from '@mantine/core';
import { RequestLogEntry } from '@/lib/requestLog';

type Props = {
    logs: RequestLogEntry[];
};

const formatter = new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
});

export function RequestLogTable({ logs }: Props) {
    return (
        <Stack gap="md">
            <Title order={2}>
                リクエスト履歴
            </Title>
            {logs.length === 0 ? (
                <Text c="dimmed">
                    まだリクエストが記録されていません。
                </Text>
            ) : (
                <Table
                    striped
                    highlightOnHover
                    withTableBorder
                    horizontalSpacing="md"
                    verticalSpacing="sm"
                >
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>時刻</Table.Th>
                            <Table.Th>IP</Table.Th>
                            <Table.Th>メソッド</Table.Th>
                            <Table.Th>パス</Table.Th>
                            <Table.Th>詳細</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {logs.map((log) => (
                            <Table.Tr key={log.id}>
                                <Table.Td>
                                    {formatter.format(new Date(log.timestamp))}
                                </Table.Td>
                                <Table.Td>
                                    <Badge color="gray" variant="light">
                                        {log.ip}
                                    </Badge>
                                </Table.Td>
                                <Table.Td>
                                    <Badge color="blue" variant="light">
                                        {log.method}
                                    </Badge>
                                </Table.Td>
                                <Table.Td>
                                    {log.path}
                                </Table.Td>
                                <Table.Td>
                                    {log.info ?? '-'}
                                </Table.Td>
                            </Table.Tr>
                        ))}
                    </Table.Tbody>
                </Table>
            )}
        </Stack>
    );
}
