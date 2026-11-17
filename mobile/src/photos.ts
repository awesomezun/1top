import * as ImagePicker from 'expo-image-picker';
import {ImageManipulator,SaveFormat} from 'expo-image-manipulator';
import {fitPhoto,kb,PHOTO_LIMIT} from './thread';

export type Photo={id:string;uri:string;name:string;mime:'image/jpeg';data:string;bytes:number;width:number;height:number};
export type Rejected={name:string;smallest:number|null};

/** Picks up to `room` photos and fits each to the relay limit: long edge at most 1600 px, re-encoded
 *  as JPEG so location and camera EXIF never leave the phone. A photo that cannot fit is left out. */
export async function pickPhotos(room:number):Promise<{photos:Photo[];rejected:Rejected[]}>{
 if(room<=0)return {photos:[],rejected:[]};
 const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],allowsMultipleSelection:true,selectionLimit:room,quality:1,exif:false,base64:false});
 if(result.canceled)return {photos:[],rejected:[]};
 const photos:Photo[]=[],rejected:Rejected[]=[];
 for(const [i,asset] of result.assets.slice(0,room).entries()){
  const name=`photo-${i+1}.jpg`;
  try{
   let {width,height}=asset;
   if(!(width>0&&height>0)){const ref=await ImageManipulator.manipulate(asset.uri).renderAsync();width=ref.width;height=ref.height;}
   const out=await fitPhoto(width,height,async(w,h,quality)=>{const ref=await ImageManipulator.manipulate(asset.uri).resize({width:w,height:h}).renderAsync();const saved=await ref.saveAsync({format:SaveFormat.JPEG,compress:quality,base64:true});return {data:saved.base64||'',uri:saved.uri};});
   if(out.ok)photos.push({id:asset.assetId||asset.uri+':'+i,uri:out.photo.uri,name,mime:'image/jpeg',data:out.photo.data,bytes:out.photo.bytes,width:out.photo.width,height:out.photo.height});
   else rejected.push({name:asset.fileName||name,smallest:out.smallest});
  }catch{rejected.push({name:asset.fileName||name,smallest:null});}
 }
 return {photos,rejected};
}

export const rejectionText=(r:Rejected,t:(en:string,ko:string)=>string)=>r.smallest===null
 ?t(`${r.name}: this photo could not be read.`,`${r.name}: 사진을 읽지 못했습니다.`)
 :t(`${r.name}: still ${kb(r.smallest)} at the smallest size, over the ${kb(PHOTO_LIMIT)} limit. Left out.`,`${r.name}: 가장 작게 줄여도 ${kb(r.smallest)}로 ${kb(PHOTO_LIMIT)} 한도를 넘어 제외했습니다.`);
