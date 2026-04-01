import { useMantineTheme } from '@mantine/core'
import type { IconProps, TablerIcon } from '@tabler/icons-react'
import type React from 'react'
import { type ForwardedRef, forwardRef } from 'react'

type Props = Omit<IconProps, 'size'> & {
  size?: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: TablerIcon | React.ComponentType<any>
}

function ScalableIconInner({ icon: IconComponent, size = 16, ...others }: Props, ref: ForwardedRef<SVGSVGElement>) {
  const theme = useMantineTheme()
  const scale = theme.scale ?? 1
  return <IconComponent ref={ref} size={size * scale} {...others} />
}

// Cast to accept extra pass-through props (e.g. `provider` for custom icon components)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ScalableIcon = forwardRef(ScalableIconInner) as any as React.FC<Props & Record<string, unknown>>
