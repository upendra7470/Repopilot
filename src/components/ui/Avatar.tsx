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
  'bg-indigo-500/20 text-indigo-400',
  'bg-emerald-500/20 text-emerald-400',
  'bg-amber-500/20 text-amber-400',
  'bg-rose-500/20 text-rose-400',
  'bg-cyan-500/20 text-cyan-400',
  'bg-violet-500/20 text-violet-400',
  'bg-pink-500/20 text-pink-400',
  'bg-teal-500/20 text-teal-400',
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
