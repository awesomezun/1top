// The customizing layout kept on this phone: SecureStore under the web's key (SecureStore keys may hold dots), read and
// written by layout.ts. The phone never kept a chosen panel view or dashboard panels, so nothing is taken over. Apart
// from layout.ts so Node can test the reader without the native store.
import * as SecureStore from 'expo-secure-store';
import {KEY,read,write,type LayoutState} from './layout';

/** The stored layout, or the defaults; locked when a newer version wrote it. A store that cannot be read reads as empty. */
export async function load():Promise<LayoutState>{let raw:string|null=null;try{raw=await SecureStore.getItemAsync(KEY);}catch{}return read(raw);}
/** Writes the layout in its stored form; false and nothing written when locked (a newer version's layout stays) or the store fails. */
export async function save(state:LayoutState):Promise<boolean>{if(state.locked)return false;try{await SecureStore.setItemAsync(KEY,write(state.layout));return true;}catch{return false;}}
