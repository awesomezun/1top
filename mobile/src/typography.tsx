import React from 'react';
import {StyleSheet,Text as NativeText,type TextProps} from 'react-native';

export const fonts={regular:'IBMPlexSansKR-Regular',medium:'IBMPlexSansKR-Medium',semibold:'IBMPlexSansKR-SemiBold',bold:'IBMPlexSansKR-Bold'};

// Embedded static faces have the same PostScript names on iOS and Android.
// Select the face explicitly so Android does not synthesize a different bold.
export function Text({style,...props}:TextProps){
  const flat=StyleSheet.flatten(style)||{};
  const weight=flat.fontWeight==='bold'?700:Number(flat.fontWeight)||400;
  const family=weight>=700?fonts.bold:weight>=600?fonts.semibold:weight>=500?fonts.medium:fonts.regular;
  return <NativeText {...props} style={[style,{fontFamily:family,fontWeight:'normal'}]}/>;
}
