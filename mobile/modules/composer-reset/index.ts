import {findNodeHandle,Platform} from 'react-native';
import {requireOptionalNativeModule} from 'expo';

// When a message is sent from a composer, Android's keyboard can still hold the word it was composing and
// type it back with the next key. Called at the send with the sent text: the field drops that text
// itself (keys typed after the tap stay) and the keyboard starts afresh on it. The iPhone and the web have
// nothing to reset.
const native=Platform.OS==='android'?requireOptionalNativeModule<{reset(tag:number,sent:string):Promise<void>}>('ComposerReset'):null;
export function resetComposer(field:Parameters<typeof findNodeHandle>[0],sent:string){
 const tag=native&&field?findNodeHandle(field):null;
 if(native&&tag!=null)native.reset(tag,sent).catch(()=>{});
}
