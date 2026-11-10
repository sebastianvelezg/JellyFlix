import { t } from '../../../i18n'

/** What a program is called on screen: its title, or a plain note when this account may not see the title (the container sends no name then). */
export const programTitle = (program: { title: string; unavailable?: boolean }): string => (program.unavailable ? t('Program not available') : program.title)
