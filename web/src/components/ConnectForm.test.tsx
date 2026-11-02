import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ConnectForm } from './ConnectForm'

afterEach(cleanup)

function typeAddress(value: string) {
  render(<ConnectForm onConnect={() => Promise.reject(new Error('not used'))} onConnected={() => {}} />)
  fireEvent.change(screen.getByLabelText('Server URL'), { target: { value } })
}

describe('ConnectForm address warning', () => {
  it('warns about an unencrypted address that is not on the home network', () => {
    typeAddress('http://media.example.com:8096')
    expect(screen.getByRole('note')).toHaveTextContent('would travel in clear text')
    expect(screen.getByLabelText('Server URL')).toHaveAttribute('aria-describedby', 'server-url-warning')
  })

  it.each(['http://192.168.0.10:8096', 'jellyfin.local:8096', 'nas:8096', 'https://media.example.com', 'media.example.com', '', 'http://'])(
    'says nothing for %j',
    (value) => {
      typeAddress(value)
      expect(screen.queryByRole('note')).toBeNull()
    },
  )
})
