import { createTheme, type MantineColorsTuple } from '@mantine/core'

// EnvironmSafe house colours (same as the printed documents).
export const brand = { navy: '#14294a', gold: '#d9a21b', grey: '#555555', light: '#e8edf3', line: '#c9d3df' }

const navy: MantineColorsTuple = ['#eef2f8', '#d9e1ee', '#b0c1dc', '#849fca', '#5f82ba', '#476fb1', '#3a65ae', '#2c5499', '#234a89', '#14294a']
const gold: MantineColorsTuple = ['#fff8e1', '#fdefcc', '#f9dd9b', '#f6ca64', '#f3ba38', '#f1b01c', '#d9a21b', '#c38e00', '#ad7d00', '#966b00']

export const theme = createTheme({
  primaryColor: 'navy',
  primaryShade: { light: 9, dark: 5 },
  colors: { navy, gold },
  fontFamily: 'Inter, "Noto Sans Arabic", system-ui, sans-serif',
  headings: { fontFamily: 'Inter, "Noto Sans Arabic", system-ui, sans-serif' },
  defaultRadius: 'md',
  components: {
    Button: { defaultProps: { size: 'md' } },
    TextInput: { defaultProps: { size: 'md' } },
    NumberInput: { defaultProps: { size: 'md' } },
    Select: { defaultProps: { size: 'md' } },
  },
})
