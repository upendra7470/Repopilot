import clsx from 'clsx'

interface AvatarProps {
  src?: string
  name: string
  size?: 'sm' | 'md' | 'lg'
}

const sizeStyles: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-10 w-10 text-sm',
}

const colorPalette = [
  'bg-accent-muted text-accent',
  'bg-success/10 text-success',
  'bg-warning/10 text-warning',
  'bg-danger/10 text-danger',
  'bg-info/10 text-info',
  'bg-bg-tertiary text-text-secondary',
]

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function getColorFromName(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colorPalette[Math.abs(hash) % colorPalette.length]
}

export function Avatar({ src, name, size = 'md' }: AvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={clsx('rounded-full object-cover', sizeStyles[size])}
      />
    )
  }

  return (
    <div
      className={clsx(
        'flex items-center justify-center rounded-full font-medium',
        sizeStyles[size],
        getColorFromName(name)
      )}
      title={name}
    >
      {getInitials(name)}
    </div>
  )
}
