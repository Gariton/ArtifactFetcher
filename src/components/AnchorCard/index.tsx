import { Card, Flex, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconChevronCompactRight } from "@tabler/icons-react";
import { memo, ReactNode } from "react";

export const AnchorCard = memo(function AnchorCardMemo({
    title,
    description,
    icon,
    href
}: {
    title: string;
    description: string;
    icon: ReactNode;
    href: string;
}) {
    return (
        <Card
            withBorder
            component="a"
            href={href}
            radius="lg"
        >
            <Flex
                gap="lg"
                align="center"
            >
                {icon}
                <Stack
                    flex={1}
                    gap="xs"
                >
                    <Title
                        order={3}
                    >
                        {title}
                    </Title>
                    <Text
                        size="sm"
                        c="dimmed"
                    >
                        {description}
                    </Text>
                </Stack>
                <ThemeIcon
                    variant="transparent"
                    color="dark"
                >
                    <IconChevronCompactRight />
                </ThemeIcon>
            </Flex>
        </Card>
    );
})