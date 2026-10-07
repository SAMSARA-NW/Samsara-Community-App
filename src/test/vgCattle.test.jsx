import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
const { from, update, eq, chain } = vi.hoisted(() => ({from:vi.fn(),update:vi.fn(),eq:vi.fn(),chain:{}}));
vi.mock('../lib/supabase.js', () => ({supabase:{from}}));
vi.mock('../hooks/useAuthSession.js', () => ({useAuthSession:()=>({data:{user:{id:'test'}}})}));
vi.mock('recharts', () => Object.fromEntries(['BarChart','Bar','LineChart','Line','XAxis','YAxis','Tooltip','ResponsiveContainer','CartesianGrid','Legend'].map(k=>[k,()=>null])));
import VgAnimals from '../pages/vg/animals/index.jsx';
const records=[{id:'cow-sep',month:9,category:'cow',opening_count:8,closing_count:8,births:0,sold:0},{id:'bull-sep',month:9,category:'bull',opening_count:3,closing_count:2,births:0,sold:1}];
beforeEach(()=>{
  update.mockClear();eq.mockClear();
  Object.assign(chain,{select:()=>chain,eq:()=>chain,then:(fn)=>Promise.resolve({data:records}).then(fn),update});
  update.mockReturnValue({eq});eq.mockResolvedValue({error:null});from.mockReturnValue(chain);
});
afterEach(cleanup);
async function mount(){
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><VgAnimals /></QueryClientProvider>);
 fireEvent.click(screen.getByRole('button',{name:'🐄 Cattle'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Edit Sold for Sep'})).toHaveTextContent('1'));
}
describe('cattle event accounting',()=>{
 it('shows opening 11, closing 10 and edits the sold bull rather than a cow',async()=>{
  await mount();const row=screen.getByText('Sep',{selector:'td'}).closest('tr');
  expect(within(row).getAllByRole('cell').map(e=>e.textContent)).toEqual(['Sep','11','10','8','2','—','—','—','—','1']);
  fireEvent.click(screen.getByRole('button',{name:'Edit Sold for Sep'}));
  expect(screen.getByRole('combobox')).toHaveValue('bull');
  fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'2'}});fireEvent.click(screen.getByRole('button',{name:'Save'}));
  await waitFor(()=>expect(eq).toHaveBeenCalledWith('id','bull-sep'));expect(update).toHaveBeenCalledWith({sold:2});
 });
 it('blocks events that would make the selected category negative',async()=>{
  await mount();fireEvent.click(screen.getByRole('button',{name:'Edit Sold for Sep'}));
  fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'4'}});fireEvent.click(screen.getByRole('button',{name:'Save'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('negative');expect(update).not.toHaveBeenCalled();
 });
 it('editing a closing headcount compensates for already recorded sales',async()=>{
  await mount();const row=screen.getByText('Sep',{selector:'td'}).closest('tr');
  fireEvent.click(within(row).getByText('2'));const input=within(row).getByRole('spinbutton');
  fireEvent.change(input,{target:{value:'2'}});fireEvent.blur(input);
  await waitFor(()=>expect(update).toHaveBeenCalledWith({opening_count:3}));
 });
});
