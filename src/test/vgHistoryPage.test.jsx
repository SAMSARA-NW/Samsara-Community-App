import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, it, expect, vi } from 'vitest';
const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../lib/vg/historyApi.js', () => ({ fetchHistoryRows: read }));
vi.mock('../pages/vg/hooks/useCurrentMember.js', () => ({ useIsAdmin: () => true }));
import VgHistory from '../pages/vg/history/index.jsx';
afterEach(cleanup);
function mount() {
  return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><VgHistory /></QueryClientProvider>);
}
describe('history request states', () => {
  it('shows genuine empty years explicitly', async () => {
    read.mockResolvedValue([]); mount();
    await waitFor(() => expect(screen.getAllByText(/No records for/)).toHaveLength(4));
  });
  it('shows errors instead of zero charts when a dataset fails', async () => {
    read.mockImplementation(source => source === 'accommodation' ? Promise.reject(new Error('offline')) : Promise.resolve([]));
    mount();
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    expect(screen.getAllByRole('button', {name:'Retry'})).toHaveLength(2);
    expect(screen.getAllByText(/No records for/)).toHaveLength(2);
  });
});
